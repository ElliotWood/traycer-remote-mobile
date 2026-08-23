/**
 * BROWSER-PROOF BUILD ONLY - not shipped, not upstreamed. Sibling of
 * `vite.config.web.ts`; same scope and same caveat.
 *
 * The add/remove half of host switching, rendered INSIDE the host picker
 * dialog through `registerHostPickerExtra`. It is deliberately inline
 * rather than a second dialog: a nested modal on a phone is a trap, and
 * splitting "pick a host" from "manage hosts" across two surfaces would
 * mean two places to look when one is unreachable.
 *
 * This is also where a failed probe's REASON lives. The picker itself only
 * renders the two-valued `status` field; the detail belongs next to the
 * remove/re-check affordances that act on it.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHostBinding } from "@/lib/host";
import {
  addStoredHost,
  readStoredHosts,
  removeStoredHost,
  type StoredHost,
} from "./host-store";
import { getLastProbe, subscribeToProbes } from "./host-directory-fetcher";

function ProbeReason(props: { readonly hostId: string }): ReactNode {
  const [, forceRender] = useState<number>(0);
  useEffect(
    () =>
      subscribeToProbes(() => {
        forceRender((previous) => previous + 1);
      }),
    [],
  );

  const probe = getLastProbe(props.hostId);
  if (probe === null) {
    return (
      <span className="text-ui-sm text-muted-foreground">Not checked yet.</span>
    );
  }
  if (probe.kind === "reachable") {
    return (
      <span className="text-ui-sm text-muted-foreground">
        Reachable — host {probe.hostVersion}
      </span>
    );
  }
  if (probe.kind === "unknown") {
    // Never rendered as "offline": we did not ask, so we did not learn.
    return (
      <span className="text-ui-sm text-muted-foreground">{probe.reason}</span>
    );
  }
  return <span className="text-ui-sm text-destructive">{probe.reason}</span>;
}

export function ManageHostsPanel(props: {
  readonly bakedHostId: string;
}): ReactNode {
  const binding = useHostBinding();
  const [expanded, setExpanded] = useState<boolean>(false);
  const [hosts, setHosts] = useState<readonly StoredHost[]>(() =>
    readStoredHosts(),
  );
  const [label, setLabel] = useState<string>("");
  const [websocketUrl, setWebsocketUrl] = useState<string>("");
  const [hostId, setHostId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const refreshDirectory = useCallback(() => {
    if (binding === null) return;
    // Re-probes every host, so a newly-added entry gets a measured status
    // immediately rather than appearing with an unproven one.
    void binding.directory.refresh();
  }, [binding]);

  const onAdd = useCallback(() => {
    const result = addStoredHost(
      { hostId, label, websocketUrl },
      [props.bakedHostId],
    );
    if (result.kind === "rejected") {
      setError(result.reason);
      return;
    }
    setError(null);
    // Pin the host we are on as an EXPLICIT selection before the list grows.
    // `HostDirectoryService.getDefaultEntry()` auto-binds only when the
    // directory holds exactly one entry - "the zero/many mobile paths
    // require an explicit user gesture before binding". Without this, adding
    // a second host and reloading leaves the app waiting for a pick it has
    // no way to make: the picker mounts above the readiness gate, but the
    // only thing that opens it (the nav drawer) is inside it.
    const activeHostId = binding?.hostClient?.getActiveHostId() ?? null;
    if (activeHostId !== null) {
      binding?.directory.selectById(activeHostId);
    }
    setHosts(result.hosts);
    setLabel("");
    setWebsocketUrl("");
    setHostId("");
    refreshDirectory();
  }, [binding, hostId, label, websocketUrl, props.bakedHostId, refreshDirectory]);

  const onRemove = useCallback(
    (id: string) => {
      setHosts(removeStoredHost(id));
      refreshDirectory();
    },
    [refreshDirectory],
  );

  if (!expanded) {
    return (
      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="manage-hosts-expand"
          onClick={() => {
            setExpanded(true);
          }}
        >
          Manage hosts
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="manage-hosts-recheck"
          onClick={refreshDirectory}
        >
          Re-check
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 border-t border-border/60 pt-3"
      data-testid="manage-hosts-panel"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-ui font-medium">This host</p>
            <ProbeReason hostId={props.bakedHostId} />
          </div>
          {/* No remove button: the baked entry is not in the store, so it
              cannot be removed by construction. Losing it would strand the
              app on a host list that excludes the host serving the page. */}
        </div>

        {hosts.map((host) => (
          <div
            key={host.hostId}
            className="flex items-start justify-between gap-2"
            data-testid={`manage-hosts-row-${host.hostId}`}
          >
            <div className="min-w-0">
              <p className="truncate text-ui font-medium">{host.label}</p>
              <p className="truncate text-ui-sm text-muted-foreground">
                {host.websocketUrl}
              </p>
              <ProbeReason hostId={host.hostId} />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-destructive hover:text-destructive"
              data-testid={`manage-hosts-remove-${host.hostId}`}
              onClick={() => {
                onRemove(host.hostId);
              }}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
        <p className="text-ui font-medium">Add a host</p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="add-host-label">Name</Label>
          <Input
            id="add-host-label"
            value={label}
            placeholder="Tonberry"
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="add-host-url">WebSocket URL</Label>
          <Input
            id="add-host-url"
            value={websocketUrl}
            placeholder="wss://host.example/rpc"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setWebsocketUrl(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="add-host-id">Host id</Label>
          <Input
            id="add-host-id"
            value={hostId}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setHostId(event.target.value);
            }}
          />
          {/* Typed, not discovered, and the copy says why rather than
              leaving it to look like laziness: no handshake frame and no
              floor RPC reports a host's id, and a synthesised one would
              stamp chats that no other client can attribute back. */}
          <p className="text-ui-sm text-muted-foreground">
            From <code>~/.traycer/host/pid.json</code> on that machine. A host
            cannot be asked for its own id, and a wrong one creates chats other
            clients cannot place.
          </p>
        </div>
        {error === null ? null : (
          <p className="text-ui-sm text-destructive" data-testid="add-host-error">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setExpanded(false);
              setError(null);
            }}
          >
            Done
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="manage-hosts-add"
            onClick={onAdd}
          >
            Add host
          </Button>
        </div>
      </div>
    </div>
  );
}
