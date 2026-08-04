/**
 * The Settings → Notifications section's data: `host.notifications.getConfig`
 * / `setConfig`. Scoped to the RENDERER channel's severity matrix only —
 * the email channel (SMTP host/port/credentials) is a desktop-only concern
 * with no mobile-appropriate UI; writes always echo the read email config
 * back unchanged (`password: {kind: "leaveUnchanged"}`) so toggling a
 * renderer severity can never blank out an already-configured email
 * channel.
 */
import { useCallback, useEffect, useState } from "react";
import { HostRpcError } from "@traycer-clients/shared/host-transport/host-messenger";
import type {
  HostNotificationsChannelMatrix,
  HostNotificationsConfigResponse,
  HostNotificationSeverity,
} from "@traycer/protocol/host/notifications/host-notifications";
import type { MobileHostClient } from "./host-client-context";

export interface UseNotificationConfigResult {
  readonly config: HostNotificationsConfigResponse | null;
  readonly loading: boolean;
  /**
   * Non-null when the read failed. The catch used to clear `loading` and
   * leave `config` null with no record of WHY — `loading || config === null`
   * then renders "Loading…" forever, indistinguishable from a genuinely slow
   * host, because there is no fourth state for "we asked and it failed."
   * `host.notifications.getConfig` is not on the released floor (checked
   * against `released-floor.ts` directly), so an older host answering
   * `E_HOST_UNSUPPORTED` is a real, reachable case, not a hypothetical one.
   */
  readonly loadError: string | null;
  readonly setRendererSeverity: (severity: HostNotificationSeverity, enabled: boolean) => Promise<void>;
}

function describeLoadFailure(cause: unknown): string {
  if (cause instanceof HostRpcError && cause.code === "E_HOST_UNSUPPORTED") {
    return "This host doesn't support notification settings yet.";
  }
  return "Couldn't load notification settings.";
}

export function useNotificationConfig(client: MobileHostClient | null): UseNotificationConfigResult {
  const [config, setConfig] = useState<HostNotificationsConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (client === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    void client
      .request("host.notifications.getConfig", {})
      .then((response) => {
        if (!cancelled) {
          setConfig(response);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setLoadError(describeLoadFailure(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const setRendererSeverity = useCallback(
    async (severity: HostNotificationSeverity, enabled: boolean): Promise<void> => {
      if (client === null || config === null) return;
      const nextMatrix: HostNotificationsChannelMatrix = {
        ...config.matrix,
        [severity]: { ...config.matrix[severity], renderer: enabled },
      };
      const response = await client.request("host.notifications.setConfig", {
        matrix: nextMatrix,
        channels: {
          renderer: {},
          email: {
            host: config.channels.email.host,
            port: config.channels.email.port,
            user: config.channels.email.user,
            password: { kind: "leaveUnchanged" },
            from: config.channels.email.from,
          },
        },
      });
      setConfig(response);
    },
    [client, config],
  );

  return { config, loading, loadError, setRendererSeverity };
}
