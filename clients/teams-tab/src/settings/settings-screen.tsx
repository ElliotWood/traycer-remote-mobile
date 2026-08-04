/**
 * App settings — the tab's counterpart to mobile's `toolbar/settings-screen`.
 *
 * The parity contract listed this row as "🔴 does not exist — `settings`
 * appears only as prose in `app.tsx` and `notifications-screen.tsx`". Sections
 * and their ORDER are mobile's, because that is where parity lives; the
 * controls are Fluent's, because decision 1 of the tab plan is that this
 * client takes its controls from the host's design system rather than
 * hand-matching a phone's.
 *
 * WHAT IS DELIBERATELY NOT PORTED, stated here rather than left as a silent
 * shortfall — a capability with no row is a gap nobody can see:
 *
 * | Mobile section | Here | Why |
 * | --- | --- | --- |
 * | Providers → expandable USAGE WINDOWS | provider + auth status only | See below. Not a shortcut — a collision avoided |
 * | Display → screen wake lock | absent | `isWakeLockSupported()` is false in a Teams tab and the control is hidden on mobile too when unsupported. A row that cannot do anything is worse than its absence |
 * | Account → "Clear cached data" | absent | Mobile clears a service worker, the Cache Storage API and IndexedDB. This client is not a PWA and registers none of them. Recorded in `account/account-menu.tsx` |
 *
 * ⚠️ **THE USAGE WINDOWS ARE NOT MINE TO BUILD, and this is the reason.**
 * Mobile normalises each provider arm's own field names through
 * `extractUsageWindows` (`clients/mobile/src/host/use-provider-usage.ts`).
 * That logic has ALREADY been generalised into `clients/shared/rate-limits/`
 * — `projectProfileUsage`, `provider-rate-limit-envelope`, `window-severity`
 * — on `traycer/mobile-v2-desktop-companion`, which is not merged here:
 *
 * ```sh
 * git log --oneline -2 -- clients/shared/rate-limits   # on that branch
 * #   5b7e1f54  M2 fix: the banner named a family when the limit was profile-wide
 * #   65921e93  M2 item 5: the rate-limit severity rules move to shared
 * ```
 *
 * Vendoring a third copy of the arm-normalisation here would be a guaranteed
 * conflict with work already done, against the tab plan's decision 6 ("extract
 * on demand, NEVER duplicate"). The correct sequence is: that branch lands,
 * then this section grows an expandable usage row against the shared module.
 * `providers.list` needs none of it, so the section is built now and the row
 * it is missing is named rather than implied.
 */
import type { ReactElement } from "react";
import {
  Body1,
  Caption1,
  Divider,
  Link,
  MessageBar,
  MessageBarBody,
  Spinner,
  Subtitle2,
  Switch,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { SignOutRegular } from "@fluentui/react-icons";
import { PROVIDER_DISPLAY_NAMES } from "@traycer/protocol/host/provider-schemas";
import type { HostNotificationSeverity } from "@traycer/protocol/host/notifications/host-notifications";
import { HOST_WS_URL } from "@/config";
import {
  type HostStatusState,
  type NotificationConfigResult,
  type ProviderSummary,
  type ProvidersState,
} from "./use-settings";

/**
 * The four severities, in mobile's order, with mobile's exact copy.
 *
 * A literal tuple rather than `Object.keys` over the zod enum: the ORDER is
 * part of the parity claim, and `z.enum` member order is not something this
 * screen should depend on the protocol to keep stable. Typed as the severity
 * union so a protocol-side rename is a compile error here rather than a row
 * that quietly stops matching anything in the matrix.
 */
const SEVERITY_ROWS: ReadonlyArray<{
  readonly severity: HostNotificationSeverity;
  readonly label: string;
}> = [
  { severity: "info", label: "Informational" },
  {
    severity: "needs_action",
    label: "Needs your action (approvals/interviews)",
  },
  { severity: "failure", label: "Failures" },
  { severity: "done", label: "Completed" },
];

const useStyles = makeStyles({
  screen: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXL,
    padding: tokens.spacingHorizontalL,
    // The frame owns the scroll; this must be able to shrink inside it or the
    // body's `overflowY: auto` never engages. Same containment rule the shell
    // documents at length.
    minHeight: 0,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  providerRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXS,
  },
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  dotOn: { backgroundColor: tokens.colorPaletteGreenForeground1 },
  dotOff: { backgroundColor: tokens.colorNeutralForeground4 },
  providerName: { flexGrow: 1, minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  /** Wraps rather than truncates — a host URL is diagnostic information. */
  hostUrl: { wordBreak: "break-all" },
  signOut: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    alignSelf: "flex-start",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    color: tokens.colorPaletteRedForeground1,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
  },
});

export interface SettingsScreenProps {
  readonly providers: ProvidersState;
  readonly notifications: NotificationConfigResult;
  readonly hostStatus: HostStatusState;
  readonly onSignOut: () => void;
}

export function SettingsScreen({
  providers,
  notifications,
  hostStatus,
  onSignOut,
}: SettingsScreenProps): ReactElement {
  const styles = useStyles();
  return (
    <main className={styles.screen}>
      <Subtitle2 as="h1">Settings</Subtitle2>
      <ProvidersSection state={providers} />
      <Divider />
      <NotificationsSection result={notifications} />
      <Divider />
      <AboutSection state={hostStatus} onSignOut={onSignOut} />
    </main>
  );
}

function SectionHeading({
  children,
}: {
  readonly children: string;
}): ReactElement {
  return (
    <Caption1 as="h2" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {children}
    </Caption1>
  );
}

function ProvidersSection({
  state,
}: {
  readonly state: ProvidersState;
}): ReactElement {
  const styles = useStyles();
  return (
    <section className={styles.section}>
      <SectionHeading>Providers</SectionHeading>
      {state.kind === "loading" ? (
        <Spinner size="tiny" label="Loading providers…" labelPosition="after" />
      ) : state.kind === "error" ? (
        <MessageBar intent="warning">
          <MessageBarBody>
            Couldn&apos;t read providers from this host. {state.detail}
          </MessageBarBody>
        </MessageBar>
      ) : state.providers.length === 0 ? (
        /*
         * A REAL ANSWER, worded as one. "No providers reported by this host"
         * is a fact about the host; "couldn't load" above is a fact about the
         * request. Rendering them the same way is the collapse `use-epics.ts`
         * exists to prevent, one screen over.
         */
        <Body1 className={styles.muted}>No providers reported by this host.</Body1>
      ) : (
        state.providers.map((provider) => (
          <ProviderRow key={provider.providerId} provider={provider} />
        ))
      )}
    </section>
  );
}

function ProviderRow({
  provider,
}: {
  readonly provider: ProviderSummary;
}): ReactElement {
  const styles = useStyles();
  const authenticated = provider.auth.status === "authenticated";
  return (
    <div className={styles.providerRow}>
      <span
        aria-hidden="true"
        className={`${styles.dot} ${provider.enabled ? styles.dotOn : styles.dotOff}`}
      />
      <Body1 className={styles.providerName}>
        {PROVIDER_DISPLAY_NAMES[provider.providerId] ?? provider.providerId}
      </Body1>
      {/*
        The host's own word for the state, except for the one case where it
        has a plain-English equivalent. `status` is a machine token
        ("unauthenticated", "expired"); showing it raw is honest and showing
        "Connected" for the good case is what mobile does, so both hold.
      */}
      <Caption1 className={styles.muted}>
        {authenticated ? "Connected" : provider.auth.status}
      </Caption1>
    </div>
  );
}

function NotificationsSection({
  result,
}: {
  readonly result: NotificationConfigResult;
}): ReactElement {
  const styles = useStyles();
  const { state, setRendererSeverity } = result;
  return (
    <section className={styles.section}>
      <SectionHeading>Notifications</SectionHeading>
      {state.kind === "loading" ? (
        <Spinner
          size="tiny"
          label="Loading notification settings…"
          labelPosition="after"
        />
      ) : state.kind === "error" ? (
        /*
         * NOT "Loading…", which is what mobile renders here forever.
         *
         * `host.notifications.getConfig` is NOT on the released floor, so a
         * host that simply does not have the method is a case this section
         * must be able to say out loud. Mobile's hook catches the rejection,
         * clears `loading` and leaves `config` null — and its render condition
         * is `loading || config === null`, so the spinner never stops. A
         * screen that is permanently loading is indistinguishable from a slow
         * host, which is why nobody has noticed.
         */
        <MessageBar intent="warning">
          <MessageBarBody>
            Couldn&apos;t read notification settings from this host — it may be
            running a version that predates them. {state.detail}
          </MessageBarBody>
        </MessageBar>
      ) : (
        <>
          <Body1>Notify me for</Body1>
          {SEVERITY_ROWS.map(({ severity, label }) => (
            <Switch
              key={severity}
              label={label}
              // `?? false` because the matrix is a `z.record` — a severity the
              // host has never been told about is absent, not false, and
              // indexing it yields `undefined`.
              checked={state.config.matrix[severity]?.renderer ?? false}
              disabled={state.saving !== null}
              onChange={(_event, data) => {
                setRendererSeverity(severity, data.checked);
              }}
            />
          ))}
          {state.saveError === null ? null : (
            <MessageBar intent="error">
              <MessageBarBody>
                That change wasn&apos;t saved, so the switches still show what
                the host has. {state.saveError}
              </MessageBarBody>
            </MessageBar>
          )}
          <Caption1 className={styles.muted}>
            Email delivery is configured in the desktop app — not shown here.
          </Caption1>
        </>
      )}
    </section>
  );
}

function AboutSection({
  state,
  onSignOut,
}: {
  readonly state: HostStatusState;
  readonly onSignOut: () => void;
}): ReactElement {
  const styles = useStyles();
  return (
    <section className={styles.section}>
      <SectionHeading>About</SectionHeading>
      <Caption1 className={`${styles.muted} ${styles.hostUrl}`}>
        {HOST_WS_URL === "" ? "No host configured" : HOST_WS_URL}
      </Caption1>
      {state.kind === "ready" ? (
        <Caption1 className={styles.muted}>
          Host v{state.status.hostVersion} · protocol{" "}
          {state.status.protocolVersion.major}.{state.status.protocolVersion.minor}
        </Caption1>
      ) : state.kind === "error" ? (
        <Caption1 className={styles.muted}>
          Host version unavailable — {state.detail}
        </Caption1>
      ) : (
        <Caption1 className={styles.muted}>Reading host version…</Caption1>
      )}
      {/*
        SIGN-OUT IS HERE **AND** IN THE ACCOUNT MENU, matching mobile, which
        carries it in both the account sheet and Settings → About. Not
        redundancy for its own sake: the frame's copy is the one that survives
        a screen that has thrown, and this one is the one a user finds by
        looking for settings. Both call the same `auth.signOut()`.
      */}
      <button type="button" className={styles.signOut} onClick={onSignOut}>
        <SignOutRegular aria-hidden="true" />
        Sign out
      </button>
      <Caption1 className={styles.muted}>
        Traycer for Teams ·{" "}
        <Link href="https://traycer.ai" target="_blank" rel="noreferrer">
          traycer.ai
        </Link>
      </Caption1>
    </section>
  );
}
