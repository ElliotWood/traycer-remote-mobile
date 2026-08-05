/**
 * The avatar → account sheet: identity, App settings (opens the Settings
 * screen), Manage subscription (external link), Sign out.
 */
import { ChevronRight, ExternalLink, LogOut, Settings, Trash2 } from "lucide-react";
import { useState, type ReactElement } from "react";
import type { AuthenticatedUser } from "@traycer/protocol/auth";
import { AUTHN_BASE_URL } from "@/config";
import { clearLocalData } from "@/host/clear-local-data";
import { resolveManageSubscriptionUrl } from "@/host/manage-subscription-url";
import { radius, theme, type } from "@/views/design-tokens";
import { BottomSheet } from "./bottom-sheet";

export interface AccountSheetProps {
  readonly user: AuthenticatedUser | null;
  readonly onClose: () => void;
  readonly onOpenSettings: () => void;
  readonly onSignOut: () => void;
}

function computeInitials(name: string | null, email: string | null): string {
  const source = (name ?? email ?? "").trim();
  if (source.length === 0) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function AccountSheet({ user, onClose, onOpenSettings, onSignOut }: AccountSheetProps): ReactElement {
  const name = user?.user.name ?? null;
  const email = user?.user.email ?? null;
  const avatarUrl = user?.user.avatarUrl ?? null;

  return (
    <BottomSheet title="Account" onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        {avatarUrl !== null ? (
          <img
            src={avatarUrl}
            alt=""
            style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "color-mix(in oklch, var(--primary) 20%, transparent)",
              color: theme.primary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {computeInitials(name, email)}
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ ...type.body, fontWeight: 600, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name ?? email ?? "Signed in"}
          </div>
          {email !== null && name !== null && (
            <div style={{ ...type.bodyXs, color: theme.mutedText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {email}
            </div>
          )}
        </div>
      </div>

      <AccountMenuRow icon={Settings} label="App settings" onClick={onOpenSettings} />
      <a
        href={resolveManageSubscriptionUrl(AUTHN_BASE_URL)}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: "none" }}
      >
        <AccountMenuRow icon={ExternalLink} label="Manage subscription" />
      </a>
      <ClearDataRow />
      <AccountMenuRow icon={LogOut} label="Sign out" onClick={onSignOut} destructive />
    </BottomSheet>
  );
}

/**
 * Two-step because it is destructive and sits one row above "Sign out" —
 * a mis-tap should not silently wipe every cached chat. Not a modal: a
 * bottom sheet inside a bottom sheet is worse on a phone than an inline
 * confirm.
 */
function ClearDataRow(): ReactElement {
  const [phase, setPhase] = useState<"idle" | "confirm" | "clearing">("idle");

  const run = (): void => {
    setPhase("clearing");
    void clearLocalData().finally(() => {
      // Reload unconditionally, even if some layer reported an error.
      // Unregistering a service worker does NOT release the page it already
      // controls — only a fresh navigation does — so skipping the reload on
      // partial failure would leave the user on exactly the stale bundle
      // they pressed this to escape. A reload is safe regardless: everything
      // cleared here is a cache that rebuilds from the host.
      window.location.reload();
    });
  };

  if (phase === "idle") {
    return <AccountMenuRow icon={Trash2} label="Clear cached data" onClick={() => setPhase("confirm")} />;
  }

  return (
    <div style={{ borderTop: `1px solid ${theme.borderHairline}`, padding: "10px 4px" }}>
      <div style={{ ...type.bodyXs, color: theme.mutedText, marginBottom: 8 }}>
        Clears locally cached chats, artifacts and the offline copy of the app, then reloads.{" "}
        <strong style={{ color: theme.text }}>You stay signed in.</strong> Nothing on the host is affected.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={run}
          disabled={phase === "clearing"}
          style={{
            minHeight: 40,
            flex: 1,
            border: `1px solid ${theme.danger}`,
            borderRadius: radius.sm,
            background: "transparent",
            color: theme.danger,
            fontSize: 14,
            fontFamily: "inherit",
            cursor: phase === "clearing" ? "default" : "pointer",
          }}
        >
          {phase === "clearing" ? "Clearing…" : "Clear and reload"}
        </button>
        <button
          type="button"
          onClick={() => setPhase("idle")}
          disabled={phase === "clearing"}
          style={{
            minHeight: 40,
            flex: 1,
            border: `1px solid ${theme.borderHairline}`,
            borderRadius: radius.sm,
            background: "transparent",
            color: theme.text,
            fontSize: 14,
            fontFamily: "inherit",
            cursor: phase === "clearing" ? "default" : "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AccountMenuRow({
  icon: Icon,
  label,
  onClick,
  destructive = false,
}: {
  readonly icon: typeof Settings;
  readonly label: string;
  readonly onClick?: () => void;
  readonly destructive?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minHeight: 44,
        padding: "0 4px",
        border: "none",
        borderTop: `1px solid ${theme.borderHairline}`,
        background: "transparent",
        color: destructive ? theme.danger : theme.text,
        fontSize: 14,
        textAlign: "left",
        cursor: "pointer",
        borderRadius: radius.sm,
      }}
    >
      <Icon size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      <ChevronRight size={14} color={theme.mutedText} aria-hidden="true" />
    </button>
  );
}
