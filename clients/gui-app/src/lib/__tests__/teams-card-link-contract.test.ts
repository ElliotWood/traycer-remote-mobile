/**
 * The CONSUMER half of the Teams "Watch progress" link contract.
 *
 * `clients/teams-bot` renders an Adaptive Card whose only button is an
 * `Action.OpenUrl` into this app. Nothing between the two parses or validates
 * that URL — Teams simply opens it — so the only thing standing between a real
 * card and a button that lands on the wrong page is whether THESE parsers
 * accept THOSE bytes. Until this file existed, nothing checked that, and the
 * bot had in fact been emitting `${base}/epics/${epicId}/chats/${chatId}`, a
 * shape copied from `clients/teams-tab` and dead since that package was
 * deleted in `cb1edae3`. It matched no route here at all, so the navigation
 * controller issued a landing correction: the user pressed the button and
 * arrived at the app's landing page, silently.
 *
 * The fixture is the producer's checked-in golden output, asserted from its
 * own side too (`clients/teams-bot/.../deep-link.test.ts` → "emits the golden
 * link"). Neither package can drift alone.
 *
 * JSON rather than a cross-package import for the same reason as
 * `push-service-envelope-contract.test.ts`: the bot is a Node process that
 * cannot import this module, and this app has no business depending on the
 * bot. A file both can read is the only seam that creates no dependency in a
 * direction neither wants.
 */
import { describe, expect, it } from "vitest";
import {
  readActiveEpicIdFromPath,
  readActiveEpicTabIdFromPath,
} from "@/lib/routes";
import { normalizeEpicFocusSearch } from "@/routes/epic-route-search";
import WIRE from "../../../../teams-bot/src/intake/__tests__/__fixtures__/watch-progress-links.json" with { type: "json" };

/**
 * The route a browser would hand the router, derived from the link rather than
 * restated in the fixture — restating it would let the two halves drift in
 * exactly the way this file exists to prevent.
 *
 * A fragment means hash history (`router.tsx` selects it for any subpath
 * deploy) and the route is everything after `#`. No fragment means browser
 * history and the route is the path plus the query. Both modes ship: `/next/`
 * is a subpath build, a root-served tab is not.
 */
function routeFromLink(link: string): { pathname: string; search: string } {
  const url = new URL(link);
  if (url.hash !== "") {
    const fragment = url.hash.slice(1);
    const boundary = fragment.search(/[?#]/);
    return boundary === -1
      ? { pathname: fragment, search: "" }
      : {
          pathname: fragment.slice(0, boundary),
          search: fragment.slice(boundary),
        };
  }
  return { pathname: url.pathname, search: url.search };
}

function searchObject(search: string): Record<string, unknown> {
  return Object.fromEntries(new URLSearchParams(search).entries());
}

const ARMS = [
  ["subpath deploy — the live `/next/` tab", WIRE.subpath],
  ["root deploy", WIRE.root],
] as const;

describe("Teams card 'Watch progress' link", () => {
  it.each(ARMS)("resolves to the epic route on a %s", (_label, arm) => {
    const { pathname } = routeFromLink(arm.link);
    // The same two readers `tabNavigationController.routedTabTarget` uses to
    // decide whether an external location names an epic at all. `null` from
    // either is the landing correction the old link triggered.
    expect(readActiveEpicIdFromPath(pathname)).toBe(arm.epicId);
    expect(readActiveEpicTabIdFromPath(pathname)).not.toBeNull();
  });

  it.each(ARMS)("carries the chat as the focused artifact on a %s", (_label, arm) => {
    const { search } = routeFromLink(arm.link);
    // A chat IS an artifact in the canvas store; `focusArtifactId` is what this
    // app's own push routing passes a chat id as (`notifications/payload.ts` →
    // `routeEpicChatNotification`). `resolveExternalEpic` copies this straight
    // onto the intent it builds for a tab id it does not recognise, which is
    // always the case for a tab opened by this link.
    expect(normalizeEpicFocusSearch(searchObject(search))).toEqual({
      focusedAt: undefined,
      focusArtifactId: arm.chatId,
      focusThreadId: undefined,
      migrationSource: undefined,
      focusPaneId: undefined,
      focusTileInstanceId: undefined,
    });
  });

  /**
   * The Teams-native form of the same button. A web link opens OUTSIDE the
   * tab, in a top-level context at our origin — a different storage partition
   * from the third-party frame Teams installs, so the device-auth tokens are
   * not there and the user lands on sign-in. An entity link opens the
   * installed tab and hands it the route as `subEntityId`, which arrives here
   * as `app.getContext().page.subPageId`.
   *
   * This app is therefore the consumer of TWO strings from the same card, and
   * they must agree. Asserting only the web link would leave the one that
   * actually runs inside Teams checked by nobody.
   */
  describe("the Teams entity deep link", () => {
    const entity = new URL(WIRE.teamsEntity.link);

    function subEntityId(): string {
      const context = JSON.parse(
        entity.searchParams.get("context") ?? "{}",
      ) as { subEntityId?: string };
      return context.subEntityId ?? "";
    }

    it("hands the tab a route these parsers resolve to the epic and the chat", () => {
      // Parsed as a route directly: `subEntityId` is app-internal, so it has
      // no origin and no fragment — it is what the tab must navigate to.
      const raw = subEntityId();
      const boundary = raw.indexOf("?");
      const pathname = boundary === -1 ? raw : raw.slice(0, boundary);
      const search = boundary === -1 ? "" : raw.slice(boundary);

      expect(readActiveEpicIdFromPath(pathname)).toBe(WIRE.teamsEntity.epicId);
      expect(readActiveEpicTabIdFromPath(pathname)).not.toBeNull();
      expect(normalizeEpicFocusSearch(searchObject(search))).toEqual({
        focusedAt: undefined,
        focusArtifactId: WIRE.teamsEntity.chatId,
        focusThreadId: undefined,
        migrationSource: undefined,
        focusPaneId: undefined,
        focusTileInstanceId: undefined,
      });
    });

    it("agrees with its own `webUrl` fallback, route for route", () => {
      // The two ends of one button. If they ever disagree, pressing it means
      // one thing in Teams and another in a browser — and both would look
      // correct in isolation.
      const web = routeFromLink(entity.searchParams.get("webUrl") ?? "");
      expect(`${web.pathname}${web.search}`).toBe(subEntityId());
    });
  });

  /**
   * THE CONTROL. Without it, both assertions above could pass because these
   * parsers accept anything. They do not: the shape the bot actually shipped
   * is rejected, and rejected specifically by the epic-id reader, which is the
   * step that turns into a landing correction.
   */
  it("CONTROL: rejects the retired tab's route shape", () => {
    const { pathname } = routeFromLink(WIRE.retiredTabShape.link);
    expect(readActiveEpicIdFromPath(pathname)).toBeNull();
    expect(readActiveEpicTabIdFromPath(pathname)).toBeNull();
  });
});
