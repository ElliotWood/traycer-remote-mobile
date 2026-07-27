// @vitest-environment jsdom
/**
 * Sprint 4's proof surface: `?comments=1&epicId=&artifactType=&artifactId=`
 * mounts the standalone `CommentsPanel` in place of the Fleet→Epic→Chat
 * drilldown, reachable only after the normal sign-in gate (a real bearer, no
 * auth bypass). Malformed/absent params fall through to the ordinary Fleet
 * view.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@traycer/protocol/auth";
import type { MobileAuthStatus } from "@/host/auth-service";
import { createFakeAuth, createFakeHostClient } from "@/test-utils/fakes";
import { renderApp } from "@/test-utils/render-app";
import { screen } from "@/test-utils/dom";

const SIGNED_IN: MobileAuthStatus = {
  kind: "signed-in",
  user: { user: { id: "u1" } } as unknown as AuthenticatedUser,
};

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("Comments harness route (?comments=1)", () => {
  it("mounts CommentsPanel with the parsed props when signed in", async () => {
    window.history.pushState(
      {},
      "",
      "/?comments=1&epicId=e1&artifactType=ticket&artifactId=a1",
    );
    const auth = createFakeAuth(SIGNED_IN);
    const { client, request } = createFakeHostClient(() =>
      Promise.resolve({ threads: [] }),
    );
    renderApp({ auth: auth.service, client });

    expect(await screen.findByText("Comments")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("epic.listCommentThreads", {
      epicId: "e1",
      artifactType: "ticket",
      artifactId: "a1",
    });
  });

  it("falls through to the Fleet view when params are malformed", async () => {
    window.history.pushState(
      {},
      "",
      "/?comments=1&epicId=e1&artifactType=not-a-kind&artifactId=a1",
    );
    const auth = createFakeAuth(SIGNED_IN);
    const { client } = createFakeHostClient(() =>
      Promise.resolve({ tasks: [], hasMore: false }),
    );
    renderApp({ auth: auth.service, client });

    expect(await screen.findByText("Your work")).toBeTruthy();
  });

  it("falls through to the Fleet view when the query param is absent", async () => {
    const auth = createFakeAuth(SIGNED_IN);
    const { client } = createFakeHostClient(() =>
      Promise.resolve({ tasks: [], hasMore: false }),
    );
    renderApp({ auth: auth.service, client });

    expect(await screen.findByText("Your work")).toBeTruthy();
  });
});
