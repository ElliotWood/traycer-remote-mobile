/**
 * @vitest-environment jsdom
 *
 * The button exists to end a session that otherwise cannot be ended from
 * inside the app. So the tests are about the SESSION, not the markup: that
 * pressing it calls the service's `signOut`, and that it names whose session
 * it is ending — the question a shared machine actually raises.
 *
 * A test asserting "renders a button labelled Sign out" would pass against a
 * button wired to nothing, which is the defect this whole feature is: the
 * method existed, shared, in this client's hand, and nothing called it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SignOutButton } from "../sign-out-button";

/*
 * EXPLICIT CLEANUP. Without it, `render` appends to the same document and
 * every test sees the previous tests' buttons — the third case failed with
 * "found multiple elements", which is the harness leaking, not the component.
 *
 * Worth the note because the tempting fix is to narrow the query until it
 * matches one element again. That would pass while the leak stayed, and the
 * next test to ask "is this the only X on screen" would inherit it.
 */
afterEach(() => {
  cleanup();
});

describe("SignOutButton", () => {
  it("calls signOut exactly once when pressed", () => {
    const onSignOut = vi.fn<() => void>();
    render(<SignOutButton userId="user-1" onSignOut={onSignOut} />);
    screen.getByRole("button", { name: /sign out/i }).click();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("names whose session it ends", () => {
    // The point of showing the id at all: on a shared machine, "am I signed
    // in as me?" is the question the control exists to answer, and a bare
    // "Sign out" answers it with a shrug.
    render(<SignOutButton userId="elliot@example.test" onSignOut={vi.fn()} />);
    expect(screen.getByText("elliot@example.test")).toBeDefined();
  });

  it("still offers sign-out when the identity has not resolved", () => {
    // Being unable to NAME the user is not a reason to trap them in the
    // session. The label is a disclosure; the button is the remedy.
    const onSignOut = vi.fn<() => void>();
    render(<SignOutButton userId={null} onSignOut={onSignOut} />);
    screen.getByRole("button", { name: /sign out/i }).click();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
