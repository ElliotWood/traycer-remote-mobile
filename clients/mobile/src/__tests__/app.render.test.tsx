// @vitest-environment jsdom
/**
 * Render tests for the T4 gate → view composition — the surface the pure-logic
 * tests (`app-gate.test.ts`, `use-epic-list.test.ts`) can't reach:
 *
 *   (a) signed-out            → the sign-in screen renders
 *   (b) signing-in            → device-flow progress (userCode + link) + Cancel
 *   (c) signed-in + host      → the fleet renders from a mocked `epic.listTasks`
 *   (d) "Show more"           → fetches and appends the next page (cursor)
 *   (e) empty vs empty+more   → empty state only when terminal; else Show more
 *   (f) row tap → Back        → routes to the epic slot and back (App→Shell→nav)
 *   (g) signed-in, no host    → the config prompt
 *
 * Auth + host client are faked; nothing hits a real socket.
 */
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import type { AuthenticatedUser } from "@traycer/protocol/auth";
import type {
  ListTaskLight,
  ListTasksResponse,
} from "@traycer/protocol/host/epic/unary-schemas";
import type {
  DeviceFlowProgress,
  MobileAuthStatus,
} from "@/host/auth-service";
import type { MobileHostClient } from "@/host/host-client-context";
import { screen } from "@/test-utils/dom";
import { createFakeAuth, createFakeHostClient } from "@/test-utils/fakes";
import { renderApp } from "@/test-utils/render-app";

const SIGNED_OUT: MobileAuthStatus = { kind: "signed-out", error: null };
const SIGNED_IN: MobileAuthStatus = {
  kind: "signed-in",
  user: { user: { id: "u1" } } as unknown as AuthenticatedUser,
};
const PROGRESS: DeviceFlowProgress = {
  userCode: "WDJB-MJHT",
  verificationUri: "https://traycer.ai/device",
  verificationUriComplete: "https://traycer.ai/device?code=WDJB-MJHT",
  expiresAtMs: 1_000,
};

function epicRow(
  id: string,
  title: string,
  over: Partial<{
    ticketCount: number;
    specCount: number;
    storyCount: number;
    reviewCount: number;
    status: string;
  }> = {},
): ListTaskLight {
  return {
    epic: {
      light: {
        id,
        title,
        initialUserPrompt: "",
        ticketCount: over.ticketCount ?? 0,
        specCount: over.specCount ?? 0,
        storyCount: over.storyCount ?? 0,
        reviewCount: over.reviewCount ?? 0,
        status: over.status ?? "",
        createdAt: 1,
        updatedAt: 1,
        createdBy: "u1",
        version: "2.0.0",
      },
      permission: null,
      repos: [],
      workspaces: [],
      roomInfo: null,
    },
  };
}

function page(
  tasks: ListTaskLight[],
  extra: Partial<ListTasksResponse> = {},
): ListTasksResponse {
  return { tasks, hasMore: false, ...extra };
}

describe("App gate → view render", () => {
  it("(a) signed-out renders the sign-in screen", () => {
    const auth = createFakeAuth(SIGNED_OUT);
    const { client } = createFakeHostClient(() => Promise.resolve(page([])));
    renderApp({ auth: auth.service, client });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("(b) signing-in shows userCode + verification link; Cancel calls cancelSignIn", async () => {
    const auth = createFakeAuth({ kind: "signing-in", progress: PROGRESS });
    const { client } = createFakeHostClient(() => Promise.resolve(page([])));
    renderApp({ auth: auth.service, client });

    expect(screen.getByText("WDJB-MJHT")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      PROGRESS.verificationUriComplete,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(auth.cancelSignIn).toHaveBeenCalledTimes(1);
  });

  it("(c) signed-in + host renders the fleet from a mocked epic.listTasks", async () => {
    const auth = createFakeAuth(SIGNED_IN);
    const { client, request } = createFakeHostClient(() =>
      Promise.resolve(
        page([
          epicRow("e1", "Auth refactor", {
            ticketCount: 6,
            specCount: 2,
            status: "in progress",
          }),
        ]),
      ),
    );
    renderApp({ auth: auth.service, client });

    expect(await screen.findByText("Auth refactor")).toBeTruthy();
    expect(screen.getByText("6 tickets · 2 specs · in progress")).toBeTruthy();
    expect(request).toHaveBeenCalledWith(
      "epic.listTasks",
      expect.objectContaining({ limit: 20, sort: "recent", filters: null }),
    );
  });

  it("(d) Show more fetches and appends the next page with the cursor", async () => {
    const auth = createFakeAuth(SIGNED_IN);
    let call = 0;
    const { client, request } = createFakeHostClient(() => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? page([epicRow("e1", "Alpha")], { hasMore: true, nextCursor: "c1" })
          : page([epicRow("e2", "Beta")]),
      );
    });
    renderApp({ auth: auth.service, client });

    await screen.findByText("Alpha");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Show more" }));

    await screen.findByText("Beta");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      "epic.listTasks",
      expect.objectContaining({ cursor: "c1" }),
    );
  });

  it("(e1) a terminal empty result shows the empty state", async () => {
    const auth = createFakeAuth(SIGNED_IN);
    const { client } = createFakeHostClient(() => Promise.resolve(page([])));
    renderApp({ auth: auth.service, client });
    expect(await screen.findByText(/No epics yet/i)).toBeTruthy();
  });

  it("(e2) empty page with more offers Show more, not the empty state", async () => {
    const auth = createFakeAuth(SIGNED_IN);
    const { client } = createFakeHostClient(() =>
      Promise.resolve(page([], { hasMore: true, nextCursor: "c1" })),
    );
    renderApp({ auth: auth.service, client });
    expect(
      await screen.findByRole("button", { name: "Show more" }),
    ).toBeTruthy();
    expect(screen.queryByText(/No epics yet/i)).toBeNull();
  });

  it("(f) tapping an epic row routes to the epic slot; Back returns to the fleet", async () => {
    const auth = createFakeAuth(SIGNED_IN);
    const { client } = createFakeHostClient(() =>
      Promise.resolve(page([epicRow("e1", "Alpha", { status: "planning" })])),
    );
    renderApp({ auth: auth.service, client });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Alpha/ }));
    // T5 replaced the epic placeholder with the real `EpicView`. renderApp does
    // not provide a stream connection, so it renders its "Chats" header for the
    // reached epic id and a disconnected indicator — enough to prove routing.
    expect(await screen.findByText("Chats")).toBeTruthy();
    expect(screen.getByText("e1")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect(await screen.findByText("Alpha")).toBeTruthy();
  });

  it("(g) signed-in with no host configured renders the config prompt", () => {
    const auth = createFakeAuth(SIGNED_IN);
    const client: MobileHostClient | null = null;
    renderApp({ auth: auth.service, client });
    expect(screen.getByText(/VITE_HOST_WS_URL/)).toBeTruthy();
  });
});
