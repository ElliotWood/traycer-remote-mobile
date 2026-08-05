/**
 * M3 — the slash-command catalogue behind the composer's `/` sheet.
 *
 * `composer.tsx` used to say `@`/`/` were deferred because there was "no
 * file-search/command-list RPC". That was false: `agent.gui.listCommands` has
 * been in the released floor (`released-floor.ts:8`) the whole time.
 *
 * ## `workingDirectory` is sent as `null`, deliberately
 *
 * The request takes `workingDirectory` and `workingDirectories`
 * (`unary-schemas.ts:255-259`), and M3's ticket originally had this hook
 * threading the chat's `worktreeBinding` into them. Measured against a real
 * host, **the host ignores both**: two genuinely different repositories
 * returned byte-identical 66-command lists, and the entries tagged
 * `(project)` are Traycer's own `traycer-*` skills rather than either repo's.
 *
 * The consequences are what matter here, and they point opposite ways:
 *
 * - **Good, and it is why `/` shipped before `@`:** this hook needs no
 *   worktree binding, so `/` works in a folderless chat — which is every chat
 *   mobile can currently create. The ticket's dependency on M5 was struck.
 * - **Bad, and not this client's to fix:** the list therefore cannot reflect
 *   the chat's repository. A chat bound to another project still gets these
 *   commands. Sending the binding anyway would imply a scoping that does not
 *   happen; `null` is the honest request.
 *
 * `harnessId`, by contrast, IS honoured and is load-bearing — claude returns
 * 66 commands and codex 25, with different names. Against the `"claude"` this
 * composer used to hard-code, the list was simply wrong for every other
 * harness. That is what M1's real harness id buys.
 */
import { useEffect, useState } from "react";
import type { GuiHarnessId } from "@traycer/protocol/host/agent/shared";
import type { GuiAgentCommandOption } from "@traycer/protocol/host/agent/gui/unary-schemas";
import type { MobileHostClient } from "@/host/host-client-context";

export type GuiCommandsPhase = "loading" | "loaded" | "error";

export interface UseGuiCommandsResult {
  readonly phase: GuiCommandsPhase;
  readonly commands: readonly GuiAgentCommandOption[];
}

export function useGuiCommands(
  client: MobileHostClient | null,
  harnessId: GuiHarnessId,
): UseGuiCommandsResult {
  const [phase, setPhase] = useState<GuiCommandsPhase>("loading");
  const [commands, setCommands] = useState<readonly GuiAgentCommandOption[]>([]);

  useEffect(() => {
    if (client === null) {
      setPhase("error");
      return;
    }
    let cancelled = false;
    setPhase("loading");
    // Same reason `use-gui-models` clears: leaving the previous harness's rows
    // up during the round trip lets a tap insert a command the selected
    // harness has never heard of. Codex's 25 and Claude's 66 barely overlap.
    setCommands([]);
    void (async (): Promise<void> => {
      try {
        const response = await client.request("agent.gui.listCommands", {
          harnessId,
          workingDirectory: null,
          workingDirectories: [],
        });
        if (cancelled) return;
        setCommands(response.commands);
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

  return { phase, commands };
}
