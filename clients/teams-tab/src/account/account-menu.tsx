/**
 * The avatar in the frame, and the menu behind it.
 *
 * WHAT IT REPLACES. `SignOutButton` rendered the raw user id as a caption
 * beside a button, and its own docblock said an id cut to `"user-a1b2…"`
 * answers nothing. It was right, and the reason it shipped that way is that
 * `status.user.user` was never read past `.id` — `name`, `email` and
 * `avatarUrl` have been in hand the whole time, unused. So this is not new
 * plumbing; it is the identity the client already had, rendered.
 *
 * WHY A MENU AND NOT MOBILE'S BOTTOM SHEET. Decision 2 of the tab plan is that
 * this is a purpose-built Fluent client, not the phone app in an iframe — "an
 * iframe of a phone app is wrong density, wrong controls". A bottom sheet on
 * desktop Teams is the wrong control; an avatar with a menu is what every
 * other surface in Teams does, and Fluent's `Menu` brings the host's own focus
 * handling, dismissal and keyboard behaviour with it. The ROWS are mobile's,
 * in mobile's order, which is where parity actually lives.
 *
 * THE ONE ROW THAT IS CONDITIONAL, and why. "App settings" renders only when
 * the screen that owns the router has published a way in — see
 * `../shell/shell-settings`. Sign-out is NOT conditional: it comes straight
 * from `App`, so it survives a screen that has thrown, which is one of the
 * three states the sign-out work was built for.
 *
 * NOT PORTED: "Clear cached data". Mobile's `clearLocalData` unregisters a
 * service worker, empties the Cache Storage API and drops IndexedDB — the tab
 * is not a PWA, registers no service worker and has none of those. A row that
 * cleared nothing would be worse than its absence, and the honest version of
 * it for this client is a different feature (the canvas layout store and the
 * artifact room cache), not a port. Recorded in the handover rather than
 * quietly dropped.
 */
import type { ReactElement } from "react";
import {
  Avatar,
  Caption1,
  Divider,
  Menu,
  MenuDivider,
  MenuItem,
  MenuItemLink,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  OpenRegular,
  SettingsRegular,
  SignOutRegular,
} from "@fluentui/react-icons";
import {
  computeInitials,
  primaryIdentityLabel,
  secondaryIdentityLabel,
} from "./initials";
import { manageSubscriptionUrl } from "./manage-subscription-url";

const useStyles = makeStyles({
  /** Never collapses — it sits in the shell's `trailing` cluster. */
  trigger: {
    flexShrink: 0,
    // A bare avatar is not obviously pressable; Fluent's `MenuTrigger` gives
    // it button semantics, and this keeps the hit target at the header's
    // rhythm rather than the image's size.
    cursor: "pointer",
    background: "none",
    border: "none",
    padding: 0,
    display: "flex",
    alignItems: "center",
  },
  identity: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
    // The menu sizes to its widest row; without a ceiling a long email makes
    // the whole popover the width of the email.
    maxWidth: "260px",
  },
  line: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  secondary: {
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  /** Sign-out is the destructive row, so it is coloured like one. */
  destructive: {
    color: tokens.colorPaletteRedForeground1,
  },
});

/**
 * The three identity fields this menu renders — and NOTHING else.
 *
 * Narrow on purpose, the same call `EpicListClient` and
 * `HostNotificationMutationClient` make one package over: a component that
 * declares `AuthenticatedUser` claims a dependency on a record with dozens of
 * required members (subscription, credits, organizations, seats), none of
 * which it touches. The practical cost is that a test cannot construct a
 * specimen without a full principal, so the surface goes untested — which is
 * most of the answer to how the identity here went unrendered for so long.
 *
 * Members are OPTIONAL so the real `AuthenticatedUser` — whose `name` and
 * `email` are `string | null`, not optional — satisfies it structurally. The
 * call site passes `status.user` unchanged.
 */
export interface AccountIdentity {
  readonly user: {
    readonly name?: string | null;
    readonly email?: string | null;
    readonly avatarUrl?: string | null;
  };
}

export interface AccountMenuProps {
  /** The signed-in principal. The menu is not rendered without one. */
  readonly user: AccountIdentity;
  /**
   * Navigate to the settings screen, or `null` when the router's owner is not
   * mounted. `null` hides the row rather than disabling it — see the module
   * docblock.
   */
  readonly onOpenSettings: (() => void) | null;
  readonly onSignOut: () => void;
}

export function AccountMenu({
  user,
  onOpenSettings,
  onSignOut,
}: AccountMenuProps): ReactElement {
  const styles = useStyles();
  const name = user.user.name ?? null;
  const email = user.user.email ?? null;
  const avatarUrl = user.user.avatarUrl ?? null;
  const primary = primaryIdentityLabel(name, email);
  const secondary = secondaryIdentityLabel(name, email);

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <button
          type="button"
          className={styles.trigger}
          // The accessible name carries WHO, because "Account" alone gives a
          // screen-reader user no way to answer the question this menu exists
          // to answer on a shared machine.
          aria-label={`Account: ${primary}`}
        >
          <Avatar
            size={24}
            name={primary}
            initials={computeInitials(name, email)}
            image={avatarUrl === null ? undefined : { src: avatarUrl }}
          />
        </button>
      </MenuTrigger>
      <MenuPopover>
        <div className={styles.identity}>
          <Text weight="semibold" className={styles.line} title={primary}>
            {primary}
          </Text>
          {secondary === null ? null : (
            <Caption1 className={styles.secondary} title={secondary}>
              {secondary}
            </Caption1>
          )}
        </div>
        <Divider />
        <MenuList>
          {onOpenSettings === null ? null : (
            <MenuItem icon={<SettingsRegular />} onClick={onOpenSettings}>
              App settings
            </MenuItem>
          )}
          {/*
            `MenuItemLink`, NOT `<MenuItem as="a">`.
            This shipped as `as="a"` and never compiled — Fluent types
            `MenuItem`'s root slot as `"div"` exactly, so the prop is a type
            error rather than an escape hatch (`tsc`: *Type '"a"' is not
            assignable to type '"div"'*). `MenuItemLink` is the component
            Fluent provides for this, and it renders a real anchor.

            A real anchor is the point: middle-click and copy-link work, which
            they would not on a click handler calling `window.open`.
            `noreferrer` because the billing page has no business reading
            `window.opener`.
          */}
          <MenuItemLink
            icon={<OpenRegular />}
            href={manageSubscriptionUrl()}
            target="_blank"
            rel="noreferrer"
          >
            Manage subscription
          </MenuItemLink>
          <MenuDivider />
          <MenuItem
            icon={<SignOutRegular className={styles.destructive} />}
            className={styles.destructive}
            onClick={onSignOut}
          >
            Sign out
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
