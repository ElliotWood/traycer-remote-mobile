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
  | { readonly name: "epic"; readonly epicId: string }
  | { readonly name: "chat"; readonly epicId: string; readonly chatId: string };

export type NavAction =
  | { readonly type: "open-epic"; readonly epicId: string }
  | { readonly type: "open-chat"; readonly epicId: string; readonly chatId: string }
  | { readonly type: "back" };

/** The stack always holds at least the Fleet root, so `currentRoute` is total. */
export type NavStack = readonly [Route, ...Route[]];

export const INITIAL_NAV_STACK: NavStack = [{ name: "fleet" }];

export function currentRoute(stack: NavStack): Route {
  return stack[stack.length - 1];
}

export function navReducer(stack: NavStack, action: NavAction): NavStack {
  switch (action.type) {
    case "open-epic":
      return [...stack, { name: "epic", epicId: action.epicId }];
    case "open-chat":
      return [
        ...stack,
        { name: "chat", epicId: action.epicId, chatId: action.chatId },
      ];
    case "back":
      // The Fleet root is never popped: backing out of it is a no-op (there is
      // nowhere above home to go).
      return stack.length > 1
        ? (stack.slice(0, -1) as unknown as NavStack)
        : stack;
  }
}
