/**
 * @vitest-environment jsdom
 *
 * The settings hooks, asserted on **what goes onto the wire** — because the
 * highest-consequence property here is invisible on screen.
 *
 * `host.notifications.setConfig` takes the WHOLE config. Toggling one renderer
 * severity therefore rewrites the email channel as a side effect, and an
 * omitted `password` blanks an already-configured SMTP credential. The screen
 * looks identical either way: the switch moves, the request succeeds, and the
 * damage is to a channel this client does not render. Only the request can
 * tell the two apart.
 *
 * The second wire property is the ECHO: `host`, `port`, `user` and `from` must
 * come back unchanged from the read. The read and write shapes are different
 * types — `HostNotificationsEmailConfigState` carries `credentialConfigured`
 * and `lastError`, `HostNotificationsEmailSetConfig` carries `password` — so
 * this is a field-by-field map, and a spread would not compile but a
 * hand-written map can quietly drop a field.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { HostNotificationsConfigResponse } from "@traycer/protocol/host/notifications/host-notifications";
import {
  useHostStatus,
  useNotificationConfig,
  useProviders,
  type SettingsClient,
} from "../use-settings";

afterEach(() => {
  cleanup();
});

interface RecordedCall {
  readonly method: string;
  readonly params: unknown;
}

/**
 * A fake `SettingsClient`.
 *
 * Asserted onto `SettingsClient["request"]` once rather than erasing the whole
 * object with `as unknown as` — this package's lint config bans the chained
 * form, and the narrow `Pick<HostRequester, "request">` seam is what makes the
 * single assertion honest: there is exactly one member to satisfy.
 */
function fakeClient(
  respond: (method: string, params: unknown) => Promise<unknown>,
): { readonly client: SettingsClient; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const request = ((method: string, params: unknown) => {
    calls.push({ method, params });
    return respond(method, params);
  }) as SettingsClient["request"];
  return { client: { request }, calls };
}

const EMAIL_READ = {
  host: "smtp.example.com",
  port: 587,
  user: "bot",
  from: "bot@example.com",
  credentialConfigured: true,
  lastError: null,
};

/**
 * `info` carries the flag under test; the other three are present because the
 * matrix is a TOTAL `Record` over all four severities and `tsc` says so.
 *
 * `email: true` on `info` is the specimen that matters: it is the field a
 * renderer-only toggle must not disturb, and it differs from the other rows so
 * a write that rebuilt the entry from defaults would be visible.
 */
function configResponse(
  rendererInfo: boolean,
): HostNotificationsConfigResponse {
  return {
    matrix: {
      info: { renderer: rendererInfo, email: true },
      needs_action: { renderer: false, email: false },
      failure: { renderer: false, email: false },
      done: { renderer: false, email: false },
    },
    channels: { renderer: { lastError: null }, email: EMAIL_READ },
  };
}

describe("useHostStatus", () => {
  it("reaches ready with the host's own version", async () => {
    const { client } = fakeClient(() =>
      Promise.resolve({
        ready: true,
        hostVersion: "1.4.2",
        protocolVersion: { major: 3, minor: 1 },
      }),
    );
    const { result } = renderHook(() => useHostStatus(client));
    await waitFor(() => {
      expect(result.current.kind).toBe("ready");
    });
    expect(result.current).toEqual({
      kind: "ready",
      status: { hostVersion: "1.4.2", protocolVersion: { major: 3, minor: 1 } },
    });
  });

  it("reaches ERROR, not a permanent loading, when the host does not answer", async () => {
    const { client } = fakeClient(() => Promise.reject(new Error("timed out")));
    const { result } = renderHook(() => useHostStatus(client));
    await waitFor(() => {
      expect(result.current.kind).toBe("error");
    });
    expect(result.current).toEqual({ kind: "error", detail: "timed out" });
  });

  it("refuses without a client rather than reporting a host that answered", () => {
    const { result } = renderHook(() => useHostStatus(null));
    expect(result.current.kind).toBe("error");
  });
});

describe("useProviders", () => {
  it("carries an EMPTY list through as a real answer", async () => {
    const { client } = fakeClient(() => Promise.resolve({ providers: [] }));
    const { result } = renderHook(() => useProviders(client));
    await waitFor(() => {
      expect(result.current.kind).toBe("ready");
    });
    // `ready` with zero rows, NOT `error`. The screen renders them
    // differently and the distinction starts here.
    expect(result.current).toEqual({ kind: "ready", providers: [] });
  });

  it("issues exactly one providers.list on mount", async () => {
    const { client, calls } = fakeClient(() =>
      Promise.resolve({ providers: [] }),
    );
    const { result } = renderHook(() => useProviders(client));
    await waitFor(() => {
      expect(result.current.kind).toBe("ready");
    });
    // The `initialised` ref is what holds this. Without it the load runs on
    // every render of a screen that re-renders on its own results — and under
    // StrictMode's double-invoke it would fire twice on mount alone.
    expect(calls.filter((c) => c.method === "providers.list")).toHaveLength(1);
  });
});

describe("useNotificationConfig — the write", () => {
  it("ECHOES the email channel back with password leaveUnchanged", async () => {
    const { client, calls } = fakeClient((method) =>
      method === "host.notifications.getConfig"
        ? Promise.resolve(configResponse(false))
        : Promise.resolve(configResponse(true)),
    );
    const { result } = renderHook(() => useNotificationConfig(client));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    act(() => {
      result.current.setRendererSeverity("info", true);
    });
    await waitFor(() => {
      expect(
        calls.some((c) => c.method === "host.notifications.setConfig"),
      ).toBe(true);
    });

    const write = calls.find(
      (c) => c.method === "host.notifications.setConfig",
    );
    // WHOLE-OBJECT assertion, deliberately. A field-by-field one only checks
    // the fields someone thought to check, and the defect this exists to
    // catch is a DROPPED field — `password` missing blanks a credential, and
    // a `toHaveProperty("matrix")` style check would pass with the entire
    // email channel gone.
    expect(write?.params).toEqual({
      // `info.email` STAYS TRUE across a renderer-only toggle, and the other
      // three severities are untouched. A computed-key assignment does not
      // type-check its value, so `tsc` would not catch an entry rebuilt from
      // defaults — this literal is what does.
      matrix: {
        info: { renderer: true, email: true },
        needs_action: { renderer: false, email: false },
        failure: { renderer: false, email: false },
        done: { renderer: false, email: false },
      },
      channels: {
        renderer: {},
        email: {
          host: "smtp.example.com",
          port: 587,
          user: "bot",
          from: "bot@example.com",
          password: { kind: "leaveUnchanged" },
        },
      },
    });
  });

  it("adopts the host's response, not the value that was requested", async () => {
    const { client } = fakeClient((method) =>
      method === "host.notifications.getConfig"
        ? Promise.resolve(configResponse(false))
        : // The host says NO — it accepted the call and kept the old value.
          Promise.resolve(configResponse(false)),
    );
    const { result } = renderHook(() => useNotificationConfig(client));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });
    act(() => {
      result.current.setRendererSeverity("info", true);
    });
    await waitFor(() => {
      const state = result.current.state;
      expect(state.kind === "ready" && state.saving).toBe(null);
    });
    const state = result.current.state;
    // An optimistic client would show `true` here and be wrong.
    expect(
      state.kind === "ready" ? state.config.matrix.info?.renderer : "unread",
    ).toBe(false);
  });

  it("a failed write reports the failure and does NOT advance the config", async () => {
    const { client } = fakeClient((method) =>
      method === "host.notifications.getConfig"
        ? Promise.resolve(configResponse(false))
        : Promise.reject(new Error("host refused")),
    );
    const { result } = renderHook(() => useNotificationConfig(client));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });
    act(() => {
      result.current.setRendererSeverity("info", true);
    });
    await waitFor(() => {
      const state = result.current.state;
      expect(state.kind === "ready" && state.saveError).toBe("host refused");
    });
    const state = result.current.state;
    expect(
      state.kind === "ready" ? state.config.matrix.info?.renderer : "unread",
    ).toBe(false);
    expect(state.kind === "ready" ? state.saving : "unread").toBe(null);
  });

  it("does not write at all when the read never landed", async () => {
    const { client, calls } = fakeClient(() =>
      Promise.reject(new Error("unknown method")),
    );
    const { result } = renderHook(() => useNotificationConfig(client));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("error");
    });
    act(() => {
      result.current.setRendererSeverity("info", true);
    });
    // There is no confirmed config to echo the email channel FROM, so a write
    // here would have to invent one — which is precisely how a checkbox
    // blanks an SMTP credential.
    expect(
      calls.filter((c) => c.method === "host.notifications.setConfig"),
    ).toHaveLength(0);
  });
});

describe("useNotificationConfig — the read", () => {
  it("reaches ERROR when the host lacks the method, not a permanent spinner", async () => {
    const { client } = fakeClient(() =>
      Promise.reject(new Error("unknown method host.notifications.getConfig")),
    );
    const { result } = renderHook(() => useNotificationConfig(client));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("error");
    });
    // `getConfig` is NOT on the released floor — this is a real host state,
    // not a hypothetical. Mobile's equivalent hook lands in a state its screen
    // renders as "Loading…" forever.
    expect(result.current.state).toEqual({
      kind: "error",
      detail: "unknown method host.notifications.getConfig",
    });
  });
});
