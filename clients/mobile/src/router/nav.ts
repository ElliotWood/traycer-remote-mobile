/**
 * Minimal client-side navigation for the Fleet → Epic → Chat drilldown (T4).
 *
 * The phone client has exactly one drilldown and no URL bar to honour, so this
 * is a plain in-memory stack rather than a router dependency: pushing a route
 * drills in, popping backs out. Later tickets plug their real views into the
 * `epic` / `chat` slots (T5/T6); T4 stands up the shell and the navigation.
 *
 * The reducer is framework-agnostic (no React import) so it is unit-testable
 * directly; `AppShell` drives it through `useReducer`.
 */

/** A location in the drilldown. Discriminated on `name` for exhaustive routing. */
export type Route =
  | { readonly name: "fleet" }
  // Sprint 6: carries the epic's title (known when opened from Fleet, which
  // already has it) so EpicView can show real text instead of the raw id.
  // `null` when reached a way that doesn't know it (e.g. `goto-chat` from a
  // notification) — EpicView omits the subtitle rather than showing the uuid.
  | { readonly name: "epic"; readonly epicId: string; readonly epicTitle: string | null }
  // P2 UX fix: carries the chat's title (already known from the epic tree
  // that opened it) so ChatView shows real text instantly instead of
  // "Untitled chat" until chat.subscribe's snapshot lands. `null` when
  // reached a way that doesn't know it (e.g. `goto-chat` from a notification).
  | { readonly name: "chat"; readonly epicId: string; readonly chatId: string; readonly chatTitle: string | null }
  // App-toolbar screens: reachable from the bell/avatar on any screen, pushed
  // onto the SAME stack (so "back" returns to wherever the user was) rather
  // than living outside the drilldown.
  | { readonly name: "notifications" }
  | { readonly name: "settings" }
  // U1 fix: a top-level route (not EpicView-local state) so an artifact
  // reference tapped from ANY screen (chat transcript, another artifact's
  // child index, notifications) can open it via `dispatch` — see
  // `artifact-nav-context.tsx`. Each open pushes a new frame, so drilling
  // through a chain of child artifacts backs out one level at a time.
  | { readonly name: "artifact"; readonly epicId: string; readonly artifactId: string };

export type NavAction =
  | { readonly type: "open-epic"; readonly epicId: string; readonly epicTitle: string }
  | { readonly type: "open-chat"; readonly epicId: string; readonly chatId: string; readonly chatTitle: string | null }
  | { readonly type: "back" }
  /**
   * S5 (C, P1): a notification click always lands on a clean [fleet, epic,
   * chat] stack, rather than pushing onto whatever stack the user happened to
   * be on — pushing `open-epic`+`open-chat` unconditionally could duplicate an
   * epic frame if the user was already inside that same epic/chat.
   */
  | { readonly type: "goto-chat"; readonly epicId: string; readonly chatId: string }
  | { readonly type: "open-notifications" }
  | { readonly type: "open-settings" }
  | { readonly type: "open-artifact"; readonly epicId: string; readonly artifactId: string };

/** The stack always holds at least the Fleet root, so `currentRoute` is total. */
export type NavStack = readonly [Route, ...Route[]];

export const INITIAL_NAV_STACK: NavStack = [{ name: "fleet" }];

export function currentRoute(stack: NavStack): Route {
  return stack[stack.length - 1];
}

export function navReducer(stack: NavStack, action: NavAction): NavStack {
  switch (action.type) {
    case "open-epic":
      return [
        ...stack,
        { name: "epic", epicId: action.epicId, epicTitle: action.epicTitle },
      ];
    case "open-chat":
      return [
        ...stack,
        { name: "chat", epicId: action.epicId, chatId: action.chatId, chatTitle: action.chatTitle },
      ];
    case "back":
      // The Fleet root is never popped: backing out of it is a no-op (there is
      // nowhere above home to go).
      return stack.length > 1
        ? (stack.slice(0, -1) as unknown as NavStack)
        : stack;
    case "goto-chat":
      return [
        { name: "fleet" },
        { name: "epic", epicId: action.epicId, epicTitle: null },
        { name: "chat", epicId: action.epicId, chatId: action.chatId, chatTitle: null },
      ];
    case "open-notifications":
      return [...stack, { name: "notifications" }];
    case "open-settings":
      return [...stack, { name: "settings" }];
    case "open-artifact":
      return [...stack, { name: "artifact", epicId: action.epicId, artifactId: action.artifactId }];
  }
}
