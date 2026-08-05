/**
 * @vitest-environment jsdom
 *
 * The account menu, and the two things about it that are NOT visible in the
 * markup.
 *
 *   1. **The "App settings" row is conditional and sign-out is not.** They
 *      arrive by different routes on purpose — `onOpenSettings` is published
 *      up from a screen and is `null` once that screen unmounts (which is what
 *      the in-frame error boundary does), while `onSignOut` comes straight
 *      from `App`. A refactor that "tidied" both onto one path would look
 *      identical here and would delete sign-out in exactly the state it exists
 *      for.
 *   2. **The identity actually renders.** The control this replaces was handed
 *      only `user.id` and printed `"user-a1b2…"`, which its own docblock
 *      admitted answers nothing. `name`/`email`/`avatarUrl` were in hand the
 *      whole time.
 *
 * The fixture is an `AccountIdentity` — the narrow prop type — and NOT a cast
 * of a fake `AuthenticatedUser`. The protocol exports that record's runtime
 * schema only through `getRecordSchema`, and a `as unknown as` around a
 * partial object is both banned by this package's lint config and the exact
 * shape that let a fixture omit a required field elsewhere in this client. The
 * component reading a narrow structural type is what makes an honest specimen
 * possible; `app.tsx` passing the real `status.user` is what proves the two
 * still meet, and that is asserted in `shell/shell-contract.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountMenu, type AccountIdentity } from "../account-menu";

afterEach(() => {
  cleanup();
});

function user(over: {
  readonly name?: string | null;
  readonly email?: string | null;
  readonly avatarUrl?: string | null;
}): AccountIdentity {
  return {
    user: {
      name: "Elliot Wood",
      email: "elliot@example.com",
      avatarUrl: null,
      ...over,
    },
  };
}

/** Opens the popover. Fluent renders menu items only while open. */
function openMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: /^Account:/ }));
}

describe("account menu — identity", () => {
  it("names the user on the trigger, so a shared machine is answerable", () => {
    render(
      <AccountMenu
        user={user({})}
        onOpenSettings={() => undefined}
        onSignOut={() => undefined}
      />,
    );
    // The accessible name carries WHO. "Account" alone gives a screen-reader
    // user no way to answer the question this menu exists to answer.
    expect(
      screen.getByRole("button", { name: "Account: Elliot Wood" }),
    ).toBeTruthy();
  });

  it("falls back to the email when there is no name, and shows no second line", () => {
    render(
      <AccountMenu
        user={user({ name: null })}
        onOpenSettings={() => undefined}
        onSignOut={() => undefined}
      />,
    );
    openMenu();
    expect(screen.getByText("elliot@example.com")).toBeTruthy();
    // Exactly ONE occurrence. The secondary line returns null when the email
    // IS the primary, and a row that repeats itself reads as a plumbing bug.
    expect(screen.getAllByText("elliot@example.com")).toHaveLength(1);
  });

  it("renders both lines when a name AND an email exist", () => {
    render(
      <AccountMenu
        user={user({})}
        onOpenSettings={() => undefined}
        onSignOut={() => undefined}
      />,
    );
    openMenu();
    expect(screen.getByText("Elliot Wood")).toBeTruthy();
    expect(screen.getByText("elliot@example.com")).toBeTruthy();
  });
});

describe("account menu — the rows, and which of them is conditional", () => {
  it("offers App settings when a screen has published a way in", () => {
    const onOpenSettings = vi.fn<() => void>();
    render(
      <AccountMenu
        user={user({})}
        onOpenSettings={onOpenSettings}
        onSignOut={() => undefined}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "App settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("HIDES App settings when no screen is mounted to navigate with", () => {
    render(
      <AccountMenu
        user={user({})}
        onOpenSettings={null}
        onSignOut={() => undefined}
      />,
    );
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "App settings" })).toBeNull();
    // PAIRED POSITIVE CONTROL, and it is the assertion that makes the null
    // above mean anything: `queryByRole` returning null equally describes a
    // menu that rendered nothing at all. Sign-out proves the menu is open and
    // populated, so the missing row is a decision rather than a blank popover.
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("KEEPS sign-out when settings is unavailable — the state it was built for", () => {
    const onSignOut = vi.fn<() => void>();
    render(
      <AccountMenu
        user={user({})}
        // The post-throw state: the boundary unmounted the screen, its
        // publisher's cleanup cleared the slot.
        onOpenSettings={null}
        onSignOut={onSignOut}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("links Manage subscription out as a real anchor, not a click handler", () => {
    render(
      <AccountMenu
        user={user({})}
        onOpenSettings={() => undefined}
        onSignOut={() => undefined}
      />,
    );
    openMenu();
    const link = screen.getByRole("menuitem", { name: "Manage subscription" });
    // An ANCHOR is the point — middle-click and copy-link work on one and do
    // not on a handler calling `window.open`. This is also the assertion that
    // catches a revert to `<MenuItem as="a">`, which does not compile and
    // whose failure mode when "fixed" by dropping the prop is a dead row.
    expect(link.getAttribute("href")).toBeTruthy();
    expect(link.getAttribute("target")).toBe("_blank");
    // The billing page has no business reading `window.opener`.
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});
