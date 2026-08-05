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
import type {
  HostNotificationsChannelMatrix,
  HostNotificationsConfigResponse,
  HostNotificationSeverity,
} from "@traycer/protocol/host/notifications/host-notifications";
import type { MobileHostClient } from "./host-client-context";

export interface UseNotificationConfigResult {
  readonly config: HostNotificationsConfigResponse | null;
  readonly loading: boolean;
  readonly setRendererSeverity: (severity: HostNotificationSeverity, enabled: boolean) => Promise<void>;
}

export function useNotificationConfig(client: MobileHostClient | null): UseNotificationConfigResult {
  const [config, setConfig] = useState<HostNotificationsConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (client === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void client
      .request("host.notifications.getConfig", {})
      .then((response) => {
        if (!cancelled) {
          setConfig(response);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
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

  return { config, loading, setRendererSeverity };
}
