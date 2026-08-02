// @vitest-environment jsdom
/**
 * The reported gap itself: "the app doesn't have a button to create new epics on
 * first page."
 *
 * These are entry-point tests, not create-flow tests (the create flow's contract
 * lives in `new-epic-view.test.tsx`). They assert the Fleet actually OFFERS the
 * action — in the header when there are epics, and in the empty state, which is
 * the exact screen a first-time phone user lands on and where the old copy dead-
 * ended them at "start one from the Traycer desktop app".
 */
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { ListTasksResponse } from "@traycer/protocol/host/epic/unary-schemas";
import { FleetView } from "@/views/fleet-view";
import { NavHost } from "@/router/nav-host";
import { createFakeHostClient, type FakeHostClient } from "@/test-utils/fakes";
import { render, screen, waitFor } from "@/test-utils/dom";

/**
 * These tests are about the ENTRY POINT, so the build has to look properly
 * configured. Without a real `VITE_HOST_ID` the create form correctly refuses to
 * render (an epic stamped with the synthetic host id would be permanently
 * unreachable — see `use-create-epic.ts`), and the test env supplies no env
 * vars, so the form would never appear. That refusal has its own coverage in
 * `new-epic-view.test.tsx`.
 */
vi.mock("@/config", () => ({
  CONFIGURED_HOST_ID: "85a4a272-315f-4953-a282-9a33fe24c815",
  HOST_WS_URL: null,
  AUTHN_CONFIGURED: false,
  AUTHN_BASE_URL: "https://authn.example.test",
  PUSH_BASE_URL: null,
}));

const EMPTY_PAGE: ListTasksResponse = { tasks: [], hasMore: false };

/** One epic row, enough for the non-empty fleet case. */
const ONE_EPIC_PAGE: ListTasksResponse = {
  hasMore: false,
  tasks: [
    {
      epic: {
        light: {
          id: "epic-1",
          title: "Existing epic",
          initialUserPrompt: "",
          ticketCount: 0,
          specCount: 0,
          storyCount: 0,
          reviewCount: 0,
          status: "todo",
          createdAt: 1,
          updatedAt: 1,
          createdBy: "user-1",
          version: "2.0.0",
        },
        permission: null,
        repos: [],
        workspaces: [],
        roomInfo: null,
      },
      phase: null,
      pinned: false,
    },
  ],
};

function renderFleet(fake: FakeHostClient): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { readonly children: ReactNode }) {
    // `NavHost` is required, not incidental: the create form registers itself as
    // a dismissible layer (`useDismissLayer`), so its Cancel routes through
    // history rather than calling `setCreating(false)` directly. Without the
    // host, `useNavBack` degrades to a no-op and Cancel silently does nothing —
    // so the real app's composition is what gets tested here.
    return (
      <QueryClientProvider client={queryClient}>
        <NavHost routeDepth={1} onPopRoutes={() => {}}>
          {children}
        </NavHost>
      </QueryClientProvider>
    );
  }
  render(
    <FleetView client={fake.client} onOpenEpic={() => {}} onSignOut={() => {}} />,
    { wrapper: Wrapper },
  );
}

function fleetClient(page: ListTasksResponse): FakeHostClient {
  return createFakeHostClient((method) => {
    if (method === "epic.listTasks") return Promise.resolve(page);
    throw new Error(`unexpected method ${method}`);
  });
}

describe("FleetView — create-epic entry point", () => {
  it("offers a New epic action in the header once epics have loaded", async () => {
    renderFleet(fleetClient(ONE_EPIC_PAGE));

    await screen.findByText("Existing epic");
    expect(screen.getByRole("button", { name: "New epic" })).toBeDefined();
  });

  it("offers its own action from the empty state instead of dead-ending on desktop-only copy", async () => {
    renderFleet(fleetClient(EMPTY_PAGE));

    // Queried by the empty state's OWN distinct name. Asserting "New epic"
    // here would be vacuous — the header renders above the body on every
    // screen, so that name resolves even with the empty state's action gone.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start your first epic" })).toBeDefined();
    });
    // The old copy told the user to go use the desktop app; it must not be the
    // whole of the empty state any more.
    expect(document.body.textContent ?? "").not.toContain(
      "Start one from the Traycer desktop app",
    );
  });

  it("opens the create form from the header action", async () => {
    renderFleet(fleetClient(ONE_EPIC_PAGE));

    await screen.findByText("Existing epic");
    await userEvent.setup().click(screen.getByRole("button", { name: "New epic" }));

    // The form is live: its instruction field and submit are on screen.
    expect(screen.getByLabelText("What should this epic do?")).toBeDefined();
    expect(screen.getByRole("button", { name: "Create epic" })).toBeDefined();
  });

  it("opens the create form from the empty-state action", async () => {
    renderFleet(fleetClient(EMPTY_PAGE));

    const cta = await screen.findByRole("button", { name: "Start your first epic" });
    await userEvent.setup().click(cta);

    expect(screen.getByLabelText("What should this epic do?")).toBeDefined();
    expect(screen.getByRole("button", { name: "Create epic" })).toBeDefined();
  });

  it("returns to the fleet when the create form is cancelled", async () => {
    renderFleet(fleetClient(ONE_EPIC_PAGE));

    const user = userEvent.setup();
    await screen.findByText("Existing epic");
    await user.click(screen.getByRole("button", { name: "New epic" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Existing epic")).toBeDefined();
  });
});
