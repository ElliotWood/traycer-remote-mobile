/**
 * The App settings screen's data: `host.status`, `providers.list` and
 * `host.notifications.{getConfig,setConfig}`.
 *
 * THREE INDEPENDENT LOADS, THREE INDEPENDENT STATES, and that is the design
 * rather than an accident of writing them separately. Only two of the four
 * methods are on the RELEASED FLOOR:
 *
 * ```sh
 * grep -nE '"(host\.status|providers\.list|host\.notifications\.)' \
 *   protocol/src/host/released-floor.ts
 * #   host.status      ✅        providers.list   ✅
 * #   host.notifications.getConfig / setConfig — ABSENT
 * ```
 *
 * So a host old enough to lack the notifications config methods must still
 * render its version and its providers. One combined state would take the
 * whole screen down with the one section that is allowed to be missing.
 *
 * WHY NOT MOBILE'S HOOKS, given the extract-on-demand rule. They are five
 * lines of `client.request` each around a `useState` that this package's
 * eslint config forbids — `react-hooks/set-state-in-effect` is ON here, and
 * every one of mobile's three hooks sets state directly in an effect body.
 * Moving them to `clients/shared` would therefore mean rewriting them anyway,
 * and doing that while `clients/mobile` has a live owner mid-turn is a merge
 * conflict for no gain. What is genuinely shared here is the PROJECTION, and
 * the only projection in this file is `describe`. Recorded so the next reader
 * does not re-litigate it as an oversight.
 *
 * The `useCallback`-invoked-from-an-effect shape below is `use-epics.ts`'s,
 * copied deliberately: it is the idiom in this package that loads over RPC
 * without tripping that rule.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostRequester } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type { ProviderId } from "@traycer/protocol/host/provider-schemas";
import type { ProviderRateLimits } from "@traycer/protocol/host/rate-limit";
import { DEFAULT_ACCOUNT_CONTEXT } from "@traycer/protocol/common/schemas";
import type {
  HostNotificationsChannelMatrix,
  HostNotificationsConfigResponse,
  HostNotificationSeverity,
} from "@traycer/protocol/host/notifications/host-notifications";

/** Only `request` is needed; kept narrow so tests inject a fake. */
export type SettingsClient = Pick<HostRequester<HostRpcRegistry>, "request">;

function describe(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

/* ── host.status ─────────────────────────────────────────────────────────── */

export interface HostStatusInfo {
  readonly hostVersion: string;
  readonly protocolVersion: {
    readonly major: number;
    readonly minor: number;
  };
}

export type HostStatusState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: HostStatusInfo }
  /**
   * Distinct from `loading`, and the About section renders it as such.
   *
   * Mobile leaves this case indistinguishable from "still waiting" — its
   * `useHostStatus` catch does nothing, so `status` stays `null` and the
   * version line is simply omitted forever. Omission is defensible for a
   * version line. It is NOT defensible for the notification matrix below,
   * where the same shape renders "Loading…" permanently, so both are modelled
   * the same way here.
   */
  | { readonly kind: "error"; readonly detail: string };

export function useHostStatus(client: SettingsClient | null): HostStatusState {
  const [state, setState] = useState<HostStatusState>({ kind: "loading" });

  const load = useCallback(() => {
    if (client === null) {
      setState({
        kind: "error",
        detail: "No Traycer host is configured for this build.",
      });
      return;
    }
    client
      .request("host.status", {})
      .then((response) => {
        setState({
          kind: "ready",
          status: {
            hostVersion: response.hostVersion,
            protocolVersion: response.protocolVersion,
          },
        });
      })
      .catch((error: unknown) => {
        setState({ kind: "error", detail: describe(error) });
      });
  }, [client]);

  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    load();
  }, [load]);

  return state;
}

/* ── providers.list ──────────────────────────────────────────────────────── */

/**
 * The three fields the Providers section reads, and nothing else.
 *
 * Narrow for the same reason `AccountIdentity` is: `ProviderCliState` composes
 * a versioned auth union that a test fixture cannot reproduce without either a
 * cast or a copy of the schema, and this package's lint config bans the cast
 * that would paper over it. `response.providers` satisfies this structurally,
 * so the RPC's real shape is still what arrives — `tsc` holds that end.
 *
 * `auth.status` widens to `string` deliberately: the section renders the
 * host's own token for every state except `authenticated`, so pinning the
 * union here would make a new provider state a compile error in a renderer
 * that already handles it correctly.
 */
export interface ProviderSummary {
  readonly providerId: ProviderId;
  readonly enabled: boolean;
  readonly auth: { readonly status: string };
  /**
   * The accounts configured for this provider, for the usage rows below.
   *
   * `kind` is widened to `string` for the same reason `auth.status` is: this
   * surface only ever compares it against `"ambient"`, and pinning the union
   * would make a new profile kind a compile error in code that already handles
   * it. `ProviderProfile` satisfies this structurally, so the real wire shape
   * is still what arrives.
   *
   * MAY be empty, and that is a real state rather than a missing one — a
   * provider that predates profiles reports none, and its usage is read with a
   * `null` profile.
   */
  readonly profiles: ReadonlyArray<{
    readonly profileId: string;
    readonly kind: string;
    readonly label: string;
  }>;
}

/**
 * A profile's COMMIT id — `null` for the ambient account, its own id
 * otherwise. This is what `host.getRateLimitUsage` wants.
 *
 * Deliberately not `profileCommitId` from
 * `@traycer-clients/shared/providers/provider-profile-model`: that function
 * takes a full `ProviderProfile`, and taking it here would drag this screen's
 * narrow summary back to the wide type the interface above exists to avoid.
 * Same rule, one field.
 *
 * ⚠️ **`clients/mobile` passes the RAW `profileId` here instead**
 * (`usage-sheet.tsx`: `profile?.profileId ?? null`), so its ambient row asks
 * for usage under the literal `"ambient"` sentinel. `provider-profile-model.ts`
 * says of exactly this case that a run-level profileId uses `null` "never the
 * wire sentinel", and `clients/gui-app`'s own caller passes `profileId: null`.
 * Two of the three clients agree and mobile is the odd one; that is a finding
 * about mobile, not a licence for this client to copy it, and it is handed over
 * rather than fixed here — changing mobile's request shape is a behaviour
 * change in a package this change is only moving code out of.
 */
export function usageProfileId(profile: {
  readonly profileId: string;
  readonly kind: string;
}): string | null {
  return profile.kind === "ambient" ? null : profile.profileId;
}

export type ProvidersState =
  | { readonly kind: "loading" }
  /**
   * `providers` MAY be empty and that is a real answer about a host with no
   * provider configured — the opposite of `error`, which is no answer at all.
   * They render differently for the reason `use-epics.ts` states at length.
   */
  | { readonly kind: "ready"; readonly providers: readonly ProviderSummary[] }
  | { readonly kind: "error"; readonly detail: string };

export function useProviders(client: SettingsClient | null): ProvidersState {
  const [state, setState] = useState<ProvidersState>({ kind: "loading" });

  const load = useCallback(() => {
    if (client === null) {
      setState({
        kind: "error",
        detail: "No Traycer host is configured for this build.",
      });
      return;
    }
    client
      .request("providers.list", {})
      .then((response) => {
        setState({ kind: "ready", providers: response.providers });
      })
      .catch((error: unknown) => {
        setState({ kind: "error", detail: describe(error) });
      });
  }, [client]);

  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    load();
  }, [load]);

  return state;
}

/* ── host.getRateLimitUsage ──────────────────────────────────────────────── */

/**
 * One profile's rate-limit windows.
 *
 * A FOURTH INDEPENDENT LOAD, per profile, and the reason is this module's
 * opening argument applied one level down: a provider whose usage read fails
 * must not take the Providers section — or the other providers' rows — with
 * it. `host.getRateLimitUsage` is on the released floor, so unlike the
 * notifications config there is no "host lacks the method" state to model;
 * what there IS is a per-account failure, because the host reaches out to the
 * provider to answer, and any one of those can fail while the rest succeed.
 *
 * `unavailable` is its own arm rather than folded into `error`. The host
 * answering "I asked, and this account cannot report usage" (`cli_not_found`,
 * `rate_limits_not_available`) is a fact about the ACCOUNT; a rejected request
 * is a fact about the request. Mobile renders both as muted text and so does
 * this, but they carry different copy, and collapsing them is the same
 * question-substitution `use-epics.ts` documents at length.
 */
export type RateLimitUsageState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly rateLimits: ProviderRateLimits }
  | { readonly kind: "error"; readonly detail: string };

export function useRateLimitUsage(
  client: SettingsClient | null,
  providerId: ProviderId,
  profileId: string | null,
): RateLimitUsageState {
  const [state, setState] = useState<RateLimitUsageState>({ kind: "loading" });

  const load = useCallback(() => {
    if (client === null) {
      setState({
        kind: "error",
        detail: "No Traycer host is configured for this build.",
      });
      return;
    }
    client
      .request("host.getRateLimitUsage", {
        accountContext: DEFAULT_ACCOUNT_CONTEXT,
        providerId,
        profileId,
      })
      .then((response) => {
        const rateLimits = response.providerRateLimits ?? null;
        if (rateLimits === null) {
          /*
           * The host answered and carried NO provider snapshot. Not an error —
           * the request succeeded — but there is nothing to render either, so
           * it takes the same shape a null-bearing response has always had on
           * mobile: "unavailable", worded as a fact about the account.
           *
           * Modelled as `error` with account-shaped copy rather than a fifth
           * arm, because the renderer's choice is binary here (windows, or a
           * muted line saying why not) and a state nothing renders differently
           * is a distinction the type system carries and the user never sees.
           */
          setState({
            kind: "error",
            detail: "This host reported no usage data for this account.",
          });
          return;
        }
        setState({ kind: "ready", rateLimits });
      })
      .catch((error: unknown) => {
        setState({ kind: "error", detail: describe(error) });
      });
  }, [client, providerId, profileId]);

  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    load();
  }, [load]);

  return state;
}

/* ── host.notifications.getConfig / setConfig ────────────────────────────── */

export type NotificationConfigState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly config: HostNotificationsConfigResponse;
      /** The severity whose write is in flight, so its row can disable. */
      readonly saving: HostNotificationSeverity | null;
      /** Set when the last write failed. See {@link setRendererSeverity}. */
      readonly saveError: string | null;
    }
  | { readonly kind: "error"; readonly detail: string };

export interface NotificationConfigResult {
  readonly state: NotificationConfigState;
  readonly setRendererSeverity: (
    severity: HostNotificationSeverity,
    enabled: boolean,
  ) => void;
}

export function useNotificationConfig(
  client: SettingsClient | null,
): NotificationConfigResult {
  const [state, setState] = useState<NotificationConfigState>({
    kind: "loading",
  });
  /**
   * The last config the HOST confirmed, mirrored out of state.
   *
   * `setRendererSeverity` needs the current config to build its write, and a
   * `setState` updater cannot supply it: the updater is not guaranteed to have
   * run by the time the line after it executes, and React invokes it twice
   * under StrictMode. Reading it back out of an updater was the first version
   * of this and it is a race that would have worked in every test and failed
   * under a double-render. The ref is written in the same two places the
   * `ready` state is, and nowhere else.
   */
  const configRef = useRef<HostNotificationsConfigResponse | null>(null);

  const load = useCallback(() => {
    if (client === null) {
      setState({
        kind: "error",
        detail: "No Traycer host is configured for this build.",
      });
      return;
    }
    client
      .request("host.notifications.getConfig", {})
      .then((config) => {
        configRef.current = config;
        setState({ kind: "ready", config, saving: null, saveError: null });
      })
      .catch((error: unknown) => {
        setState({ kind: "error", detail: describe(error) });
      });
  }, [client]);

  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    load();
  }, [load]);

  /**
   * Toggle one severity on the RENDERER channel.
   *
   * TWO THINGS ARE LOAD-BEARING HERE.
   *
   * 1. The email channel is echoed back unchanged with
   *    `password: {kind: "leaveUnchanged"}`. `setConfig` takes the whole
   *    config, so a write that omitted it would blank an already-configured
   *    SMTP credential as a side effect of ticking a checkbox. Carried from
   *    mobile's hook, which documents the same hazard. The read and write
   *    shapes are DIFFERENT types — `HostNotificationsEmailConfigState` has
   *    `credentialConfigured`/`lastError`, `HostNotificationsEmailSetConfig`
   *    has `password` — so this is a field-by-field map and not a spread.
   *
   * 2. **The checkbox is driven by `config`, which only advances on a
   *    SUCCESSFUL response.** A failed write therefore leaves the control
   *    showing what the host still believes, and `saveError` says why. The
   *    alternative — optimistically flipping the control — produces a screen
   *    that claims a setting the host never accepted, which is this client's
   *    single most-repeated defect class in a new place.
   */
  const setRendererSeverity = useCallback(
    (severity: HostNotificationSeverity, enabled: boolean): void => {
      if (client === null) return;
      const config = configRef.current;
      // No confirmed config means the read never landed, so there is nothing
      // to echo the email channel back FROM. Writing a matrix built on a
      // guess is how a checkbox blanks an SMTP credential.
      if (config === null) return;
      setState((prev) =>
        prev.kind === "ready"
          ? { ...prev, saving: severity, saveError: null }
          : prev,
      );

      /*
       * `email` SURVIVES THE TOGGLE, and the spread is what carries it.
       *
       * The entry type is `Record<"renderer" | "email", boolean>` — both
       * channels required — so replacing the entry with `{ renderer }` would
       * drop this severity's email setting. The spread preserves it.
       *
       * Checked rather than assumed, because the obvious worry here is that
       * `config.matrix[severity]` might be absent and the spread would then
       * produce a partial entry: **the matrix is a TOTAL `Record` over the
       * four severities**, not a partial one, so the entry is always present.
       * That is worth writing down because the computed-key assignment below
       * would NOT catch it if it were — TypeScript widens a computed key to
       * an index signature and stops checking the value against the declared
       * member type. The guarantee comes from the matrix type, not from this
       * line, and the whole-object assertion in `__tests__/use-settings` is
       * what pins the resulting request.
       */
      const nextMatrix: HostNotificationsChannelMatrix = {
        ...config.matrix,
        [severity]: { ...config.matrix[severity], renderer: enabled },
      };
      client
        .request("host.notifications.setConfig", {
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
        })
        .then((updated) => {
          configRef.current = updated;
          setState({
            kind: "ready",
            config: updated,
            saving: null,
            saveError: null,
          });
        })
        .catch((error: unknown) => {
          setState((prev) =>
            prev.kind === "ready"
              ? { ...prev, saving: null, saveError: describe(error) }
              : prev,
          );
        });
    },
    [client],
  );

  return { state, setRendererSeverity };
}
